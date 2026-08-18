"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createSupportRequestAction } from "@/lib/actions/reports";
import { SUPPORT_CATEGORIES, SUPPORT_CATEGORY_LABELS, createSupportRequestSchema } from "@/lib/validations/report";
import type { SupportCategory } from "@/lib/supabase/types";

export function SupportForm() {
  const [category, setCategory] = useState<SupportCategory>("booking");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<{ subject?: string; message?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = createSupportRequestSchema.safeParse({ category, subject, message });
    if (!parsed.success) {
      const fieldErrors: { subject?: string; message?: string } = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "subject" || field === "message") fieldErrors[field] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    const result = await createSupportRequestAction(parsed.data);
    setSubmitting(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Sent. We'll reply in your notifications.");
    setSubject("");
    setMessage("");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="support-category">What&apos;s this about?</Label>
        <Select value={category} onValueChange={(value) => setCategory(value as SupportCategory)}>
          <SelectTrigger id="support-category" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORT_CATEGORIES.map((value) => (
              <SelectItem key={value} value={value}>
                {SUPPORT_CATEGORY_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="support-subject">Subject</Label>
        <Input
          id="support-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          placeholder="A one-line summary"
          aria-invalid={Boolean(errors.subject)}
          aria-describedby={errors.subject ? "support-subject-error" : undefined}
        />
        {errors.subject && (
          <p id="support-subject-error" role="alert" className="text-sm text-destructive">
            {errors.subject}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="support-message">What happened?</Label>
        <textarea
          id="support-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={4000}
          rows={7}
          aria-invalid={Boolean(errors.message)}
          aria-describedby={errors.message ? "support-message-error" : undefined}
          className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Include booking references, venue names, or anything else that helps us find it."
        />
        {errors.message && (
          <p id="support-message-error" role="alert" className="text-sm text-destructive">
            {errors.message}
          </p>
        )}
      </div>

      <Button type="submit" disabled={submitting} className="self-start">
        {submitting ? "Sending…" : "Send message"}
      </Button>
    </form>
  );
}
