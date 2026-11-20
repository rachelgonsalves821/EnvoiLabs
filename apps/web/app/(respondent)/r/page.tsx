import { Button, Card, Echo, Sheet } from "@envoi-labs/ui";
import { respondentCopy as copy } from "./copy";

export default function RespondentHome() {
  return (
    <Card className="respondent-welcome">
      <div>
        <h1>{copy.title}</h1>
        <p>{copy.instruction}</p>
      </div>
      <div className="respondent-echo"><Echo state="idle" size={144} /></div>
      <Sheet trigger={<Button variant="secondary">{copy.help}</Button>} title={copy.help} description={copy.helpIntro}>
        <p>{copy.helpDetail}</p>
      </Sheet>
    </Card>
  );
}
