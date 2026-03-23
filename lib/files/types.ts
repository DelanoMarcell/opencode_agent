export type StoredFileSource = "device" | "ms365";

export type StoredFileListItem = {
  fileId: string;
  rawSessionId?: string;
  matterId?: string;
  originalName: string;
  relativePath: string;
  source: StoredFileSource;
  ms365LocationId?: string;
  ms365DriveId?: string;
  ms365ItemId?: string;
  ms365WebUrl?: string;
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
