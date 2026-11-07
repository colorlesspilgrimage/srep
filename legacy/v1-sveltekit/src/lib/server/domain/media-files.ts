export type MediaFiles = {
  /** Writes the file once. A second write with the same sha keeps the first file. */
  write(sha: string, bytes: Buffer): Promise<void>;
  /** Returns null when the file does not exist. */
  read(sha: string): Promise<Buffer | null>;
};
