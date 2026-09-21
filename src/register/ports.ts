export interface GitHubClient {
  getFileSha(path: string): Promise<string | null>;
  readFileContent(path: string): Promise<string>;
  commitFile(
    path: string,
    content: string,
    message: string,
    sha: string | null
  ): Promise<{ commitSha: string }>;
}

export interface DriveClient {
  uploadVersionedFile(folderId: string, name: string, content: string): Promise<{ fileId: string }>;
  readManifest(): Promise<Record<string, unknown>>;
  writeManifest(manifest: Record<string, unknown>): Promise<void>;
}
