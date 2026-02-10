export class FirestorePermissionError extends Error {
  constructor(info: string | { operation: string; path: string }) {
    const message = typeof info === 'string' ? info : `Permission denied for ${info.operation} on ${info.path}`;
    super(message);
    this.name = "FirestorePermissionError";
  }
}