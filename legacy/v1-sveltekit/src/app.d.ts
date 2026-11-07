declare global {
  namespace App {
    interface Locals {
      session: { id: string; csrfToken: string; kind: 'cookie' | 'bearer' } | null;
    }
  }
}

export {};
