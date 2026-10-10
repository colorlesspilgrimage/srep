declare global {
  namespace App {
    interface Locals {
      session: { id: string; csrfToken: string } | null;
    }
  }
}

export {};
