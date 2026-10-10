declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      session: { id: string; csrfToken: string } | null;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
