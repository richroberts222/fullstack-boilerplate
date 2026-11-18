"use client";

import { DELETE_CONFIRMATION } from "@app-boilerplate/validation";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { deleteMyAccount, exportMyData } from "@/app/account/legal-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// "Your data" on the dashboard (/docs/features/legal-gate.md AC5 to AC8): download everything held about
// you, or delete your account after typing the confirmation word.
export function MyData() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Card className="w-full max-w-md" data-testid="my-data">
      <CardHeader>
        <CardTitle>Your data</CardTitle>
        <CardDescription>Download everything held about you, or delete your account.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Button
          variant="outline"
          className="h-11"
          data-testid="my-data-export"
          onClick={async () => {
            setMessage(null);
            const result = await exportMyData({});
            if (!result.ok) return setMessage(result.error.message);
            const url = URL.createObjectURL(new Blob([result.data.json], { type: "application/json" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = result.data.filename;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download my data
        </Button>
        <form
          className="flex flex-col gap-2 border-t pt-4"
          data-testid="my-data-delete-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!window.confirm("Delete your account for good? This cannot be undone.")) return;
            setBusy(true);
            setMessage(null);
            const result = await deleteMyAccount({ confirm });
            if (!result.ok) {
              setBusy(false);
              return setMessage(result.error.message);
            }
            router.replace("/");
            router.refresh();
          }}
        >
          <Label htmlFor="delete-confirm">Delete my account: type {DELETE_CONFIRMATION} to confirm</Label>
          <p className="text-sm text-muted-foreground">Your account and the data held about you are deleted. Records the law requires us to keep are kept without your name.</p>
          <Input id="delete-confirm" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="my-data-delete-confirm" />
          <Button type="submit" variant="destructive" className="h-11" disabled={busy || confirm.trim().toUpperCase() !== DELETE_CONFIRMATION} data-testid="my-data-delete">
            {busy ? "Deleting..." : "Delete my account"}
          </Button>
        </form>
        {message && (
          <p role="alert" className="text-sm text-destructive" data-testid="my-data-error">
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
