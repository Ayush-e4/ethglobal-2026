import { cardLine, type HireView } from "@/lib/api";

export type Status = HireView["status"];
export type StepState = "done" | "now" | "todo" | "bad";
export interface Step {
  id: string;
  label: string;
  detail?: string;
  state: StepState;
}

export const FINAL: Status[] = ["cancelled", "released", "refunded", "failed"];

const at = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "";

/**
 * A hire's path, start to finish: paid into escrow → undo window → booked → review window →
 * paid out by Hedera. Each step is done, happening now, still to come, or went wrong.
 */
export function hireSteps(o: {
  status: Status;
  hire: HireView | null;
  name: string;
  paid: boolean; // the payment reached escrow (a transaction exists)
  canUndo: boolean;
  undoLeft: string; // "0:32"
  undoUntil: string;
}): Step[] {
  const { status, hire, name } = o;
  if (status === "failed" && !o.paid)
    return [{ id: "pay", label: hire?.note ?? "The payment didn't go through", state: "bad" }];
  const steps: Step[] = [
    status === "paying"
      ? { id: "pay", label: "Paying into escrow on Hedera…", state: "now" }
      : {
          id: "pay",
          label: "Paid into escrow on Hedera",
          detail: at(hire?.createdAt),
          state: "done",
        },
  ];
  if (status === "cancelled") {
    steps.push({
      id: "undo",
      label: "You undid it: refunded in full, nothing booked",
      state: "done",
    });
    return steps;
  }
  steps.push(
    o.canUndo
      ? {
          id: "undo",
          label: `Undo window · ${o.undoLeft} left`,
          detail: `until ${at(o.undoUntil)}`,
          state: "now",
        }
      : status === "paying"
        ? { id: "undo", label: "Undo window", state: "todo" }
        : { id: "undo", label: "Undo window over", detail: at(o.undoUntil), state: "done" },
  );
  const booked: Step = {
    id: "book",
    label: `Booked · reference ${hire?.bookingRef ?? "pending"}`,
    state: "done",
  };
  if (status === "refunded") {
    const reported = hire?.note?.toLowerCase().includes("report");
    if (hire?.bookingRef) steps.push(booked);
    steps.push({
      id: "end",
      label: reported
        ? `${name} accepted your report and refunded you`
        : `${name} couldn't book it and refunded you`,
      state: "done",
    });
    return steps;
  }
  if (status === "failed") {
    steps.push({ id: "end", label: hire?.note ?? "It didn't go through", state: "bad" });
    return steps;
  }
  if (status === "paying" || status === "held")
    steps.push(
      o.canUndo || status === "paying"
        ? { id: "book", label: `${name} books it when the undo window ends`, state: "todo" }
        : { id: "book", label: `${name} is booking it…`, state: "now" },
    );
  else steps.push(booked);

  const reviewEnd = hire?.reviewUntil;
  if (status === "disputed")
    steps.push(
      {
        id: "review",
        label: "You reported a problem: the money is frozen on Hedera",
        detail: `${name} sorts it out`,
        state: "bad",
      },
      { id: "payout", label: "Payout on hold", state: "todo" },
    );
  else if (status === "released")
    steps.push(
      { id: "review", label: "Review window over, nothing reported", state: "done" },
      {
        id: "payout",
        label: `Hedera paid ${name} by itself`,
        detail: at(reviewEnd),
        state: "done",
      },
    );
  else
    steps.push(
      status === "delivered"
        ? {
            id: "review",
            label: "Review window: report a problem if anything's wrong",
            detail: reviewEnd ? `until ${at(reviewEnd)}` : undefined,
            state: "now",
          }
        : { id: "review", label: "Review window", state: "todo" },
      {
        id: "payout",
        label: `Hedera pays ${name} when the review ends`,
        detail: status === "delivered" && reviewEnd ? `about ${at(reviewEnd)}` : undefined,
        state: "todo",
      },
    );
  return steps;
}

/** What else happened along the way: the agent's one-time card, a later cancel, a price watch. */
export function hireExtras(hire: HireView | null, name: string): Step[] {
  if (!hire) return [];
  const extras: Step[] = [];
  if (hire.card)
    extras.push({
      id: "card",
      label: `${name} paid with a one-time card (simulated) ${cardLine(hire.card)}`,
      state: hire.card.status !== "authorized" ? "done" : "todo",
    });
  if (hire.bookingCancelledAt)
    extras.push({ id: "cancelled", label: "You cancelled the booking afterwards", state: "done" });
  if (hire.watchNote)
    extras.push({
      id: "watch",
      label: `${name}: ${hire.watchNote}`,
      state: hire.watching ? "now" : "done",
    });
  return extras;
}
