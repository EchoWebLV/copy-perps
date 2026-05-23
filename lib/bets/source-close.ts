import type { WhaleCopyMeta } from "./whale-meta";

export function shouldAutoCloseWhaleCopy(args: {
  meta: WhaleCopyMeta;
  sourceStillOpen: boolean;
}): boolean {
  return (
    args.meta.autoCloseOnSourceClose === true && args.sourceStillOpen === false
  );
}
