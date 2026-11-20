import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Echo } from "./echo";
import { Button, EarningsChip, Field, ProgressTrack } from "./primitives";

describe("accessible component markup", () => {
  it("uses a native button that does not submit by default", () => {
    const html = renderToStaticMarkup(<Button variant="secondary">Close</Button>);
    expect(html).toContain('type="button"');
    expect(html).toContain('data-variant="secondary"');
  });

  it("associates a field with its label, hint and error", () => {
    const html = renderToStaticMarkup(
      <Field id="answer" label="Your answer" hint="A sentence is enough." error="Enter an answer." aria-describedby="form-hint" />,
    );
    expect(html).toContain('for="answer"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="form-hint answer-hint answer-error"');
    expect(html).toContain('id="answer-error"');
  });

  it("pairs visual progress and earnings with readable descriptions", () => {
    const progress = renderToStaticMarkup(<ProgressTrack current={2} total={3} />);
    const earnings = renderToStaticMarkup(<EarningsChip amount="$7" />);
    expect(progress).toContain("2 of 3");
    expect(progress).toContain('aria-hidden="true"');
    expect(progress).toContain('data-step="current"');
    expect(earnings).toContain("Interview reward");
    expect(earnings).toContain("$7");
  });

  it("leaves a decorative Echo out of the accessibility tree and labels a standalone one", () => {
    expect(renderToStaticMarkup(<Echo state="idle" size={40} />)).toContain('aria-hidden="true"');
    const html = renderToStaticMarkup(<Echo state="listen" size={144} aria-hidden={false} />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Recording"');
  });
});
