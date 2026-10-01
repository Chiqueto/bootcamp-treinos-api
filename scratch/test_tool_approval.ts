import { streamText, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

async function runRejectionTest() {
  let executeCount = 0;

  const tools = {
    saveDraft: tool({
      description: "Save draft",
      inputSchema: z.object({ name: z.string() }),
      needsApproval: true,
      execute: async ({ name }) => {
        executeCount++;
        return { success: true, name };
      },
    }),
  };

  const model = new MockLanguageModelV3({
    doStream: async () => {
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: "text-start",
              id: "txt-1",
            });
            controller.enqueue({
              type: "text-delta",
              id: "txt-1",
              delta: "Entendido, não salvei o rascunho. O que gostaria de alterar?",
            });
            controller.enqueue({
              type: "text-end",
              id: "txt-1",
            });
            controller.enqueue({
              type: "finish",
              finishReason: "stop",
              usage: {
                inputTokens: { total: 10 },
                outputTokens: { total: 10 },
              },
            });
            controller.close();
          },
        }),
      };
    },
  });

  // User REJECTS the tool approval request
  console.log("--- User Rejects approval ---");
  const messagesWithRejection: any[] = [
    {
      id: "msg-1",
      role: "user",
      parts: [{ type: "text", text: "Salva um plano" }],
    },
    {
      id: "msg-2",
      role: "assistant",
      parts: [
        {
          type: "tool-saveDraft",
          toolCallId: "call-1",
          state: "approval-responded",
          input: { name: "Plano Teste" },
          approval: {
            id: "appr-1",
            approved: false,
            reason: "Usuário rejeitou o salvamento",
          },
        },
      ],
    },
  ];

  const { convertToModelMessages } = await import("ai");
  const modelMessages = await convertToModelMessages(messagesWithRejection);

  const result = streamText({
    model,
    tools,
    messages: modelMessages,
  });

  const streamResponse = result.toUIMessageStreamResponse();
  const reader = streamResponse.body?.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader!.read();
    if (done) break;
    text += decoder.decode(value);
  }

  console.log("Execute count after rejection (must be 0):", executeCount);
  console.log("Stream response after rejection:\n", text);
}

runRejectionTest().catch(console.error);
