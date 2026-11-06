export function ErrorBox(props: { error: unknown; reset: () => void }) {
  return (
    <div class="error" role="alert">
      <p>{props.error instanceof Error ? props.error.message : String(props.error)}</p>
      <button
        class="retry"
        onClick={() => {
          props.reset();
        }}
      >
        Retry
      </button>
    </div>
  );
}
