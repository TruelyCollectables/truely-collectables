import InstaCompScanner from "../instacomp/InstaCompScanner";
import InstaCompAdminFrame from "../instacomp/InstaCompAdminFrame";

export const dynamic = "force-dynamic";

export default function InstaCompDirectPage() {
  return (
    <InstaCompAdminFrame
      eyebrow="Direct operator lane"
      title="InstaComp™ Direct Scan Lab"
      description="Scan, correct, remove, retry, merge quantities, price, and draft cards from a focused admin operator lane. The page owns its route config, and the row controls are labeled so bad scans, active scans, and duplicate quantities do not become dead ends."
    >
      <InstaCompScanner />
    </InstaCompAdminFrame>
  );
}
