// Compatibility export for infrastructure adapters. The implementation lives
// in application so use cases and adapters share one HTTP policy without an
// application -> infrastructure dependency.
export * from '../application/http-client.ts';
