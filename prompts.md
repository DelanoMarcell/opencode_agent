# Prompts

Current code location:

- `components/agent-shell/agent-client-runtime.tsx`
- `buildAttachedFilesBlock(...)`
- `buildUploadedFileLibraryBlock(...)`

## Attached Files Runtime Prompt

This is the current hidden runtime prompt block appended below the user's visible message when files are attached for a request.

It is used to tell the model which exact local files are in scope for that specific request.

```text
<attached_files>
These are the only attached files for this request.
Use only these exact paths when accessing attached files for this request.
Do not use any other local files unless the user explicitly asks you to.
Refer to attached files by filename only in your response, not by full path.
LNP/session-files/...
LNP/session-files/...
</attached_files>
```

Template shape:

```text
<attached_files>
These are the only attached files for this request.
Use only these exact paths when accessing attached files for this request.
Do not use any other local files unless the user explicitly asks you to.
Refer to attached files by filename only in your response, not by full path.
{relativePath1}
{relativePath2}
...
</attached_files>
```

## Uploaded File Library Runtime Prompt

This is the current hidden runtime prompt block appended below the user's visible message when no explicit files are attached, but a pre-existing session or matter file library exists for the request.

It is used to tell the model:

- there were no explicit attachments for this turn
- which uploaded-file library is in scope
- how many files are currently in that library

```text
<uploaded_file_library>
The user has not explicitly attached files for this request.
For uploaded-file work in this request, this is the only uploaded-file library you may use.
Use this exact directory path when checking uploaded files for this request.
Library scope: session
Directory: LNP/session-files/ses_...
File count: 0
There are currently no uploaded files in this directory.
Refer to uploaded files by filename only in your response, not by full path.
</uploaded_file_library>
```

Template shape:

```text
<uploaded_file_library>
The user has not explicitly attached files for this request.
For uploaded-file work in this request, this is the only uploaded-file library you may use.
Use this exact directory path when checking uploaded files for this request.
Library scope: {session|matter}
Directory: {libraryRelativePath}
File count: {fileCount}
{availabilitySentence}
Refer to uploaded files by filename only in your response, not by full path.
</uploaded_file_library>
```
