import type { ComponentProps } from "react";

import { Input } from "~/components/ui/input";

type FormFieldProps = {
  error?: string;
  hint?: string;
  label: string;
  name: string;
} & Omit<ComponentProps<"input">, "id" | "name">;

export function FormField({
  error,
  hint,
  label,
  name,
  ...inputProps
}: FormFieldProps) {
  const id = `field-${name}`;
  const descriptionId = `${id}-description`;
  const description = error ?? hint;

  return (
    <div className="grid gap-1.5">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <Input
        aria-describedby={description ? descriptionId : undefined}
        aria-invalid={error ? true : undefined}
        className="h-10"
        id={id}
        name={name}
        {...inputProps}
      />
      {description ? (
        <p
          className={
            error ? "text-sm text-destructive" : "text-xs text-muted-foreground"
          }
          id={descriptionId}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}
