export function FullScreenLoadingV3() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-(--bg-gradient) px-6 text-(--ink)">
      <div className="bg-(--paper) px-10 py-10">
        <div className="loader-v3" aria-label="Loading" role="status" />
      </div>
      <style>{`
        .loader-v3 {
          width: 120px;
          height: 20px;
          -webkit-mask: linear-gradient(90deg, #000 70%, transparent 0) left / 20% 100%;
          mask: linear-gradient(90deg, #000 70%, transparent 0) left / 20% 100%;
          background:
            linear-gradient(var(--brand) 0 0) left -25% top 0 / 20% 100% no-repeat,
            var(--paper-3);
          animation: fullscreen-loader-v3 1s infinite steps(6);
        }

        @keyframes fullscreen-loader-v3 {
          100% {
            background-position: right -25% top 0;
          }
        }
      `}</style>
    </div>
  );
}
