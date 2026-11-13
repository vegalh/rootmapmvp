// Invite codes for early access. This is the one place to add or retire a code.
//
//   To add a code:    add a line to INVITE_CODES.
//   To retire a code: delete its line. Nobody new can enter with it. People who already entered with it stay in:
//                     their device remembers that they got in, not which code they used.
//
// Codes are compared without regard to capitals, spaces or dashes, so "grow 2026" and "GROW-2026" are the same code.
//
// This is a soft gate, not security. The codes are part of the app's public files (and of this public repository),
// so anyone who looks can read them. See src/lib/inviteGate.ts for what the gate does and does not do.
export const INVITE_CODES: readonly string[] = [
  "GROW-2026", // first early-access group. Replace with your own before sharing.
];

// Where someone without a code can ask for one.
export const REQUEST_INVITE_URL = "https://myrootmap.com/#invite";
