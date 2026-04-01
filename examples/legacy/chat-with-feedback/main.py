#!/usr/bin/env python3
"""
Simple chat example with feedback-based example collection.

Usage:
    export OPPER_API_KEY="your_api_key"
    python main.py

Flow:
    - Start a simple chat loop with the model
    - After each answer, ask the user if they liked it
    - If the answer is liked, save the interaction as a dataset example
"""

import os
import sys
from typing import List, Optional

from opperai import Opper
from pydantic import BaseModel, Field


class ChatTurn(BaseModel):
    """One turn in a chat-style interaction."""
    role: str = Field(description="The role of the speaker, either 'user' or 'assistant'")
    content: str = Field(description="The text content of the message")


class ChatInput(BaseModel):
    """Input to the chat function."""
    conversation: List[ChatTurn] = Field(
        description="The full conversation history so far, alternating between user and assistant messages."
    )


class ChatOutput(BaseModel):
    """Model response to the latest user message."""
    thoughts: str = Field(
        description="The assistant's internal reasoning about how to answer the last user message."
    )
    answer: str = Field(
        description="The final answer shown to the user, written clearly and helpfully."
    )


def chat_call(opper: Opper, conversation: List[ChatTurn]):
    """
    Core call to the Opper function.

    This will auto-create the function on first call and attach a dataset.
    """
    result = opper.call(
        name="chat_with_feedback",
        instructions=(
            "You are a helpful assistant having a multi-turn conversation with a user. "
            "Use the conversation history to answer the latest user message. "
            "Write a brief, clear answer in the 'answer' field."
        ),
        input_schema=ChatInput,
        output_schema=ChatOutput,
        input=ChatInput(conversation=conversation),
        configuration={
            "invocation.few_shot.count": 3,
        },
        model="groq/gpt-oss-20b",
    )
    return result


def ensure_function(opper: Opper, function_name: str = "chat_with_feedback"):
    """
    Ensure the function exists and return (function, dataset_id).

    The function will be auto-created on first call, so this helper is mostly
    for retrieving the dataset_id for saving examples.
    """
    try:
        fn = opper.functions.get_by_name(name=function_name)
        dataset_id = getattr(fn, "dataset_id", None)
        return fn, dataset_id
    except Exception:
        # Function may not exist yet; it will be created on first call.
        return None, None


def save_liked_example(opper: Opper, conversation: List[ChatTurn], output: ChatOutput, dataset_id: Optional[str]):
    """
    Save a liked example to the function's dataset, if available.
    """
    if not dataset_id:
        # Try once more to find the function and its dataset
        fn, dataset_id_retry = ensure_function(opper)
        if not dataset_id_retry:
            print("⚠️  Could not find dataset for function yet; skipping save.")
            return
        dataset_id = dataset_id_retry

    try:
        opper.datasets.create_entry(
            dataset_id=dataset_id,
            input=ChatInput(conversation=conversation).model_dump(),
            output=output.model_dump(),
            comment="User liked this answer in interactive chat.",
        )
        print("✓ Saved liked answer as an example in the dataset.")
    except Exception as e:
        print(f"⚠️  Warning: failed to save example to dataset: {e}")


def main():
    api_key = os.getenv("OPPER_API_KEY", "")
    if not api_key:
        print("\n✗ Error: OPPER_API_KEY environment variable not set")
        print("Please set your API key: export OPPER_API_KEY='your_key_here'")
        sys.exit(1)

    try:
        opper = Opper(http_bearer=api_key)
    except Exception as e:
        print(f"\n✗ Error initializing Opper client: {e}")
        sys.exit(1)

    print("=" * 70)
    print("  Chat with Feedback - Example")
    print("=" * 70)
    print("Type your questions and press Enter.")
    print("Type 'exit' or 'quit' to end the chat.\n")

    conversation: List[ChatTurn] = []

    # Optionally, fetch function/dataset info early (will succeed after first call)
    fn, dataset_id = ensure_function(opper)
    if fn and dataset_id:
        print(f"✓ Found function '{fn.name}' with dataset_id: {dataset_id}")
    elif fn:
        print(f"✓ Found function '{fn.name}', waiting for dataset to be created on first call.")

    while True:
        user_input = input("\nYou: ").strip()
        if user_input.lower() in {"exit", "quit"}:
            print("Goodbye!")
            break

        if not user_input:
            continue

        conversation.append(ChatTurn(role="user", content=user_input))

        try:
            result = chat_call(opper, conversation)
        except Exception as e:
            print(f"✗ Error calling chat_with_feedback: {e}")
            # Remove the last user turn if the call failed
            conversation.pop()
            continue

        payload = result.json_payload
        output = ChatOutput(**payload)

        # Append assistant message to conversation history
        conversation.append(ChatTurn(role="assistant", content=output.answer))

        print(f"\nAssistant:\n{output.answer}")

        # Ask for feedback
        while True:
            like = input("\nDid you like this answer? (y/n): ").strip().lower()
            if like in {"y", "yes"}:
                save_liked_example(opper, conversation, output, dataset_id)
                break
            elif like in {"n", "no"}:
                print("Okay, not saving this answer.")
                break
            else:
                print("Please enter 'y' or 'n'.")


if __name__ == "__main__":
    main()


