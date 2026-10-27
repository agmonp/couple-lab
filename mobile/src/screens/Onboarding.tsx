import { useState } from "react";
import type { AddressForm } from "@shared/deckForms";
import { useStore } from "../store";
import { Screen } from "../ui";

/**
 * Value in the first minute, no sign-up: two names and how each wants to be
 * addressed, then straight to tonight's question.
 */
function PersonFields({ label, name, form, onName, onForm }: {
  label: string;
  name: string;
  form: AddressForm | null;
  onName: (v: string) => void;
  onForm: (f: AddressForm) => void;
}) {
  return (
    <div className="card">
      <label className="field">
        {label}
        <input type="text" value={name} onChange={(e) => onName(e.target.value)} maxLength={24} autoComplete="off" placeholder="שם פרטי" />
      </label>
      <span className="small muted">איך לפנות{name.trim() ? ` אל ${name.trim()}` : ""}?</span>
      <div className="segmented" role="group" aria-label="לשון פנייה">
        <button type="button" aria-pressed={form === "m"} onClick={() => onForm("m")}>בלשון זכר</button>
        <button type="button" aria-pressed={form === "f"} onClick={() => onForm("f")}>בלשון נקבה</button>
      </div>
    </div>
  );
}

export function Onboarding({ onJoin }: { onJoin?: () => void }) {
  const store = useStore();
  const [step, setStep] = useState<"hello" | "names">("hello");
  const [aName, setAName] = useState("");
  const [bName, setBName] = useState("");
  const [aForm, setAForm] = useState<AddressForm | null>(null);
  const [bForm, setBForm] = useState<AddressForm | null>(null);

  if (step === "hello") {
    return (
      <Screen actions={
        <>
          <button className="btn btn-primary" onClick={() => setStep("names")}>מתחילים</button>
          {onJoin && <button className="btn btn-quiet" onClick={onJoin}>האפליקציה כבר אצלנו בטלפון השני</button>}
        </>
      }>
        <div className="stack" style={{ marginTop: "12vh" }}>
          <span className="eyebrow">Couple Lab</span>
          <h1>שאלה אחת, ערב אחד, שיחה אחת.</h1>
          <p className="lead">טלפון אחד מספיק. בלי הרשמה ובלי חשבון: כל מה שתכתבו נשאר בטלפון הזה.</p>
          <p className="muted">בזמן השיחה הטלפון מונח עם המסך למטה, והעיניים עליכם.</p>
        </div>
      </Screen>
    );
  }

  const ready = aName.trim() && bName.trim() && aForm && bForm && aName.trim() !== bName.trim();
  return (
    <Screen
      onBack={() => setStep("hello")}
      actions={
        <button
          className="btn btn-primary"
          disabled={!ready}
          onClick={() => ready && store.setCouple({ name: aName.trim(), form: aForm! }, { name: bName.trim(), form: bForm! })}
        >
          לשאלה של הערב
        </button>
      }
    >
      <h2>מי אתם?</h2>
      <p className="muted">השמות ולשון הפנייה עוזרים לנו לדבר אל כל אחד כמו שהוא רוצה. אפשר לשנות אחר כך.</p>
      <PersonFields label="אחד מכם" name={aName} form={aForm} onName={setAName} onForm={setAForm} />
      <PersonFields label="והשני" name={bName} form={bForm} onName={setBName} onForm={setBForm} />
    </Screen>
  );
}
