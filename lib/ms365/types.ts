export type Ms365AllowedLocation = {
  id: string;
  label: string;
  siteId: string;
  driveId?: string;
  rootItemId?: string;
  webUrl?: string;
};

export type Ms365LocationSummary = {
  id: string;
  label: string;
  siteId: string;
  driveId: string;
  rootItemId: string;
  webUrl?: string;
  driveName?: string;
  rootName: string;
};

export type Ms365BrowserItem = {
  id: string;
  name: string;
  kind: "file" | "folder";
  size?: number;
  webUrl?: string;
  driveId: string;
  parentItemId?: string;
  lastModifiedDateTime?: string;
};

export type Ms365AttachmentSelection = Ms365BrowserItem & {
  locationId: string;
  locationLabel: string;
};
