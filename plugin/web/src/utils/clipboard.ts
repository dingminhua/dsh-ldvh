/**
 * 复制到剪贴板（Clipboard API 优先，受限上下文回退 textarea + execCommand）。
 *
 * 页面常运行于 DSH 的 iframe 内，Clipboard API 可能被权限策略拒绝，因此保留
 * textarea 回退；两处（CopyPathButton / GoalSection）共用同一实现，避免行为漂移。
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the textarea fallback for constrained browser contexts.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}
