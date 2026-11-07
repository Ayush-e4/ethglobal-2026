import Link from "next/link";
import { Shell } from "./shell";

export type Merchant = { name: string; account: string; verified: boolean };
export const btn =
  "flex min-h-12 items-center justify-center rounded-xl px-5 text-[15px] font-semibold";

/** No shop yet: name it (a passkey account), or pay one instead (a demo account). */
export function SetUpShop({
  isDemo,
  name,
  onName,
  onSubmit,
  error,
}: {
  isDemo: boolean;
  name: string;
  onName: (n: string) => void;
  onSubmit: () => void;
  error: string | null;
}) {
  return (
    <Shell title="Get paid in person">
      {isDemo ? (
        <>
          <p className="text-sm text-ink-2">
            Getting paid goes into your own Face ID wallet. Sign in with a passkey to set it up; a
            demo account can still <b>pay</b> a shop.
          </p>
          <Link href="/pay" replace className={`${btn} press bg-teal text-white`}>
            Pay a shop instead
          </Link>
        </>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <p className="text-sm text-ink-2">
            Customers pay you by scanning a QR on this screen. The money goes to your Face ID wallet
            on Hedera. One real person per shop: you verify with World ID once, and your shop&apos;s
            name is yours alone.
          </p>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            The name customers see
            <input
              value={name}
              onChange={(e) => onName(e.target.value)}
              placeholder="Chai Point, Bandra"
              maxLength={40}
              className="min-h-12 rounded-xl border border-line-2 px-3 text-[15px] font-normal"
            />
          </label>
          <button
            type="submit"
            disabled={name.trim().length < 2}
            className={`${btn} bg-teal text-white disabled:opacity-50`}
          >
            Start getting paid
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      {error?.includes("World ID") && (
        <Link href="/wallet" className={`${btn} border border-line-2 bg-white text-teal`}>
          Verify with World ID in Wallet
        </Link>
      )}
    </Shell>
  );
}
