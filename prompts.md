# Prompts

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
