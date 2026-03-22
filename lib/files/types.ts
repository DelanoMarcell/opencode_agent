export type StoredFileListItem = {
  fileId: string;
  rawSessionId?: string;
  matterId?: string;
  originalName: string;
  mime?: string;
  size: number;
  createdAt: string;
};

export type StoredFileUploadResult = {
  index: number;
  status: "uploaded" | "duplicate";
  file: StoredFileListItem;
};

export type StoredFileSummary = {
  fileCount: number;
  hasFiles: boolean;
};
