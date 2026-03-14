export function FullScreenLoadingV2() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-(--bg-gradient) px-6 text-foreground">
      <div className="border-2 border-(--border) bg-background px-10 py-10 shadow-[8px_8px_0_rgba(var(--shadow-ink),0.16)]">
        <div className="loader-v2" aria-label="Loading" role="status">
          <span />
          <span />
        </div>
      </div>
      <style>{`
        .loader-v2 {
          width: 32px;
          height: 16px;
          display: flex;
        }

        .loader-v2 span {
          flex: 1;
          background: var(--brand);
          transform-origin: top right;
          animation: fullscreen-loader-v2 2s infinite;
        }

        .loader-v2 span:last-child {
          background: var(--danger);
          transform-origin: top left;
          animation-delay: 0.25s;
        }

        @keyframes fullscreen-loader-v2 {
          0%,
          5% {
            transform: rotate(0deg);
          }
          20%,
          30% {
            transform: rotate(90deg);
          }
          45%,
          55% {
            transform: rotate(180deg);
          }
          70%,
          80% {
            transform: rotate(270deg);
          }
          95%,
          100% {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
