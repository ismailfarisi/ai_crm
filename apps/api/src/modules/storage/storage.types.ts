/** The bytes half of an attachment. One interface, two drivers. */
export interface StoredObject {
  body: Buffer;
  contentType: string;
}

export interface StorageDriver {
  readonly name: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  /**
   * A URL the browser can follow without an auth header, valid briefly.
   *
   * `null` from a driver that cannot sign one itself — the local driver — in
   * which case the service signs an API URL instead.
   */
  signedUrl(
    key: string,
    filename: string,
    ttlSeconds: number,
  ): Promise<string | null>;
}

/** What the upload route hands the service, independent of multer's types. */
export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}
