"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * /projects/new — Static route to prevent Next.js from routing "new"
 * to the dynamic [id] segment. Redirects to /projects with the modal open
 * via search param, or just redirects back to /projects.
 */
export default function NewProjectRedirect() {
  const router = useRouter();
  
  useEffect(() => {
    router.replace("/projects?new=1");
  }, [router]);

  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">Redirecting...</p>
    </div>
  );
}
