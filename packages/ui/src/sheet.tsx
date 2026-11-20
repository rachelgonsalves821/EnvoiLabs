"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "./primitives";

interface SheetProps {
  trigger: ReactElement;
  title: string;
  description: string;
  children: ReactNode;
  closeLabel?: string;
}

export function Sheet({ trigger, title, description, children, closeLabel = "Close" }: SheetProps) {
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null);

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <div ref={setPortalHost} className="ev-sheet-host" />
      <Dialog.Portal container={portalHost}>
        <Dialog.Overlay className="ev-sheet-overlay" />
        <Dialog.Content className="ev-sheet">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          {children}
          <Dialog.Close asChild><Button variant="secondary">{closeLabel}</Button></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
