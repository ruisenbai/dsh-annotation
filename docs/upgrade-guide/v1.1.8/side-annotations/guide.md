---
kind: upgrade-guide
description: Sidebar annotations use protocol v6 and storage v7, which older plugin builds cannot read.
---

# Sidebar annotations

[English](guide.md) | [简体中文](guide.zh.md)

## Change

**Ask in side chat** becomes **Annotate in sidebar**. A saved side note uses the ordinary annotation record and submission flow. Message `source.sessionId` identifies the original conversation independently of the receiving Session. New submissions use protocol v6 and annotation storage writes use v7; older plugin builds cannot read these new values.

Pending side references without a frozen request become annotations with the original quote and no written opinion. Frozen legacy retries, unknown delivery outcomes, and sent history retain their original payloads. Existing side chats, drafts, and associations remain available.

## Migration

1. Update the Host and Client halves of `dsh-annotation` together, then reload the Web page. Avoid older plugin pages writing to the same browser storage after migration; downgrading new records is unsupported.
2. Open the side chat and inspect its annotation record. Pending references migrate only after their annotation save succeeds. If storage fails, retain the browser data, resolve the storage problem, and reopen or retry the chat; conversion reuses stable identities.
3. Resolve any existing frozen retry using its original controls. Do not replace an unknown request with a new send solely because its response was lost.
4. Select text in the main reply, choose **Annotate in sidebar**, and confirm the editor's receiving title and quote. Save a note, locate its source, and send from the side composer to verify the new flow.

See [persistence acknowledgement](../../../compatibility.md#cross-conversation-annotation-persistence-acknowledgement) for version handling.
