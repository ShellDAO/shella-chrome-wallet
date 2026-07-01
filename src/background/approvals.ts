import type { ApprovalRequest } from '../types.js';

const APPROVAL_TTL_MS = 10 * 60 * 1000;

const pendingApprovals = new Map<
  string,
  {
    request: ApprovalRequest;
    resolve: (approved: boolean) => void;
    timeoutId: ReturnType<typeof setTimeout>;
    windowId?: number;
  }
>();

// WALLET-L1: use cryptographically secure RNG for all request/approval IDs.
function generateRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function handleApprovalWindowRemoved(windowId: number): void {
  for (const [requestId, pending] of pendingApprovals) {
    if (pending.windowId === windowId) {
      settleApprovalRequest(requestId, false);
      return;
    }
  }
}

export async function requestUserApproval(
  input: Omit<ApprovalRequest, 'id'>,
): Promise<boolean> {
  const requestId = generateRequestId();
  const request: ApprovalRequest = { id: requestId, ...input };

  return new Promise<boolean>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      settleApprovalRequest(requestId, false);
    }, APPROVAL_TTL_MS);
    (timeoutId as { unref?: () => void }).unref?.();
    pendingApprovals.set(requestId, { request, resolve, timeoutId });

    chrome.windows.create(
      {
        url: chrome.runtime.getURL(`popup.html?approvalId=${encodeURIComponent(requestId)}`),
        type: 'popup',
        width: 420,
        height: 680,
      },
      (window) => {
        if (chrome.runtime.lastError) {
          const pending = pendingApprovals.get(requestId);
          if (pending) {
            clearTimeout(pending.timeoutId);
            pendingApprovals.delete(requestId);
          }
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        const pending = pendingApprovals.get(requestId);
        if (pending && typeof window?.id === 'number') {
          pending.windowId = window.id;
        }
      },
    );
  });
}

export function getApprovalRequest(requestId: string): ApprovalRequest {
  const pending = pendingApprovals.get(requestId);
  if (!pending) throw new Error('Approval request not found');
  return pending.request;
}

export function resolveApprovalRequest(requestId: string, approved: boolean): { ok: true } {
  const pending = pendingApprovals.get(requestId);
  if (!pending) throw new Error('Approval request not found');
  if (Date.now() - pending.request.createdAt > APPROVAL_TTL_MS) {
    settleApprovalRequest(requestId, false);
    throw new Error('Approval request has expired');
  }
  settleApprovalRequest(requestId, approved);
  return { ok: true };
}

function settleApprovalRequest(requestId: string, approved: boolean): void {
  const pending = pendingApprovals.get(requestId);
  if (!pending) return;
  clearTimeout(pending.timeoutId);
  pendingApprovals.delete(requestId);
  pending.resolve(approved);
}
