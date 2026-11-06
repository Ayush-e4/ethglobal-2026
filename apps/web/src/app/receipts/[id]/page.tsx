import { InAppBack } from "@/components/InAppBack";
import { LogoMark } from "@/components/icons";
import { ReceiptView } from "@/components/trips/ReceiptView";

/** A booking's public proof: anyone with the link can check it, no sign-in. */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="flex min-h-dvh flex-col items-center gap-8 bg-side px-4 pt-[max(32px,env(safe-area-inset-top))] pb-10">
      <div className="relative flex w-full max-w-[560px] items-center justify-center">
        <span className="absolute left-0">
          <InAppBack />
        </span>
        <span className="flex items-center gap-2.5">
          <span className="flex size-[34px] items-center justify-center rounded-[10px] bg-teal text-white">
            <LogoMark size={20} />
          </span>
          <span className="text-xl font-bold">Shikigami</span>
        </span>
      </div>
      <ReceiptView id={id} />
    </main>
  );
}
