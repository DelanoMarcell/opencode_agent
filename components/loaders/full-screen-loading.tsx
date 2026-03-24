export function FullScreenLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-(--bg-gradient) px-6 text-foreground">
      <div className="border-2 border-(--border) bg-background px-10 py-10 shadow-[8px_8px_0_rgba(var(--shadow-ink),0.16)]">
        <div className="loader-v1" aria-label="Loading" role="status">
          <span />
          <span />
        </div>
      </div>
      <style>{`
        .loader-v1 {
          width: 40px;
          aspect-ratio: 1;
          position: relative;
        }

        .loader-v1 span {
          content: "";
          position: absolute;
          top: 0;
          left: 0;
          margin: -8px 0 0 -8px;
          width: 16px;
          aspect-ratio: 1;
          background: var(--brand);
          animation:
            fullscreen-loader-v1-path 2s infinite,
            fullscreen-loader-v1-spin 0.5s infinite;
        }

        .loader-v1 span:last-child {
          background: var(--danger);
          animation-delay: -1s, 0s;
        }

        @keyframes fullscreen-loader-v1-path {
          0% {
            top: 0;
            left: 0;
          }
          25% {
            top: 100%;
            left: 0;
          }
          50% {
            top: 100%;
            left: 100%;
          }
          75% {
            top: 0;
            left: 100%;
          }
          100% {
            top: 0;
            left: 0;
          }
        }

        @keyframes fullscreen-loader-v1-spin {
          80%,
          100% {
            transform: rotate(0.5turn);
          }
        }
      `}</style>
    </div>
  );
}
