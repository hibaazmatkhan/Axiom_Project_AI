import { FirebaseError } from "firebase/app";

const MESSAGES: Record<string, string> = {
  "auth/invalid-email": "Enter a valid email address.",
  "auth/missing-password": "Enter your password.",
  "auth/weak-password": "Use at least 8 characters for your password.",
  "auth/email-already-in-use": "An account already exists for that email.",
  "auth/invalid-credential": "The email or password is incorrect.",
  "auth/wrong-password": "The email or password is incorrect.",
  "auth/user-not-found": "No account exists for that email.",
  "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
  "auth/popup-closed-by-user": "Google sign-in was closed before it finished.",
  "auth/popup-blocked": "The Google popup was blocked. Allow popups and try again.",
  "auth/operation-not-allowed": "That sign-in method is not enabled for this project.",
  "auth/unauthorized-domain": "This domain is not authorized in Firebase Authentication.",
  "auth/network-request-failed": "The authentication service is unreachable. Check your connection.",
  "auth/requires-recent-login": "Sign in again before changing this security setting.",
  "auth/multi-factor-auth-required": "Enter your authenticator code to finish signing in.",
  "auth/invalid-verification-code": "That authenticator code is not valid.",
  "auth/code-expired": "That authenticator code expired. Try the current code.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/account-exists-with-different-credential":
    "That email is already linked to a different sign-in method.",
  "auth/cancelled-popup-request": "Another sign-in popup is already open.",
};

export function authErrorMessage(error: unknown): string {
  if (error instanceof FirebaseError) {
    return MESSAGES[error.code] ?? "Sign-in failed. Try again.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Try again.";
}
