import { Suspense, type ReactNode } from "react";
import GoogleCustomerReviewsOptIn from "../../components/GoogleCustomerReviewsOptIn";

export default function SuccessLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Suspense fallback={null}>
        <GoogleCustomerReviewsOptIn />
      </Suspense>
    </>
  );
}
