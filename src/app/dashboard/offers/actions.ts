'use server';

// All offer management logic (create, update, delete) has been moved to 
// the client-side in `offer-dialogs.tsx` to use the authenticated user's context
// for Firestore operations, resolving permission issues.
// Mass application functions remain as they are better suited for server-side execution,
// but they will require a similar refactor if they are to be used.
