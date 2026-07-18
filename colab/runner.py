"""QuickInterviewTest fixed Colab + Gradio runner, version 1.0.0.

This process is a temporary renderer. It never receives answer keys, never scores,
never stores durable results, and never executes candidate-provided text.
"""

from __future__ import annotations

import argparse
import os
import threading
import time
import uuid
from typing import Any

import gradio as gr
import requests

RUNNER_VERSION = "1.0.0"


class Backend:
    def __init__(self, base_url: str, runner_token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        exchange = self.session.post(
            f"{self.base_url}/api/runner/exchange",
            json={"runnerToken": runner_token},
            timeout=30,
        )
        exchange.raise_for_status()
        payload = exchange.json()
        if payload.get("runnerVersion") != RUNNER_VERSION:
            raise RuntimeError("Backend and Colab runner versions do not match")
        self.deployment_id = payload["deploymentId"]
        self.username = payload["gradioUsername"]
        self.password = payload["gradioPassword"]
        self.session.headers["Authorization"] = f"Bearer {payload['runnerCredential']}"

    def request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        response = self.session.request(method, f"{self.base_url}/api/runner{path}", timeout=30, **kwargs)
        response.raise_for_status()
        return response.json()

    def manifest(self) -> dict[str, Any]:
        return self.request("GET", "/manifest")

    def start(self) -> dict[str, Any]:
        return self.request("POST", "/start", json={})

    def save(self, question_id: str, value: Any) -> str:
        payload = self.request(
            "PUT",
            f"/answers/{question_id}",
            json={"value": value, "idempotencyKey": str(uuid.uuid4())},
        )
        return f"Saved at {payload['savedAt']}"

    def submit(self) -> str:
        payload = self.request("POST", "/submit", json={"idempotencyKey": str(uuid.uuid4())})
        return f"Submitted at {payload['submittedAt']}. You may close this tab."

    def register(self, url: str) -> None:
        self.request("POST", "/register", json={"gradioUrl": url})

    def heartbeat_forever(self) -> None:
        while True:
            try:
                self.request("POST", "/heartbeat", json={})
            except requests.RequestException as error:
                print(f"Heartbeat warning: {error}")
            time.sleep(30)


def component_for(question: dict[str, Any]) -> gr.Component:
    label = f"{question['position']}. {question['title']}"
    description = question.get("description") or ""
    prompt = question["prompt"]
    info = f"{description}\n\n{prompt}".strip()
    answer = question.get("answer")
    if question["type"] == "SINGLE_CHOICE":
        choices = [(choice["label"], choice["id"]) for choice in question["choices"]]
        return gr.Radio(choices=choices, value=answer, label=label, info=info)
    if question["type"] == "MULTIPLE_CHOICE":
        choices = [(choice["label"], choice["id"]) for choice in question["choices"]]
        return gr.CheckboxGroup(choices=choices, value=answer or [], label=label, info=info)
    lines = 4 if question["type"] == "SHORT_ANSWER" else 10
    return gr.Textbox(value=answer or "", label=label, info=info, lines=lines, max_lines=30)


def build_app(backend: Backend) -> gr.Blocks:
    manifest = backend.manifest()
    if manifest["attempt"]["state"] not in {"STARTED", "IN_PROGRESS", "SUBMITTED"}:
        manifest = backend.start()

    with gr.Blocks(title=manifest["test"]["title"]) as demo:
        gr.Markdown(f"# {manifest['test']['title']}")
        gr.Markdown(manifest["test"].get("description") or "")
        gr.Markdown(
            f"Candidate: **{manifest['candidate']['name']}**  \n"
            f"Deadline (UTC): **{manifest['attempt']['deadlineAt']}**"
        )
        status = gr.Markdown("Answers save directly to QuickInterviewTest.")
        for question in manifest["questions"]:
            component = component_for(question)
            component.change(
                fn=lambda value, question_id=question["id"]: backend.save(question_id, value),
                inputs=component,
                outputs=status,
                queue=False,
            )
        submit = gr.Button("Submit final answers", variant="primary")
        submit.click(fn=backend.submit, outputs=status, queue=False)
    return demo


def run(base_url: str, runner_token: str) -> None:
    backend = Backend(base_url, runner_token)
    demo = build_app(backend)
    launched = demo.launch(
        share=True,
        auth=(backend.username, backend.password),
        prevent_thread_lock=True,
        show_error=True,
    )
    share_url = launched[2] if isinstance(launched, tuple) and len(launched) > 2 else None
    if not share_url:
        raise RuntimeError("Gradio did not provide a public HTTPS share URL")
    backend.register(share_url)
    threading.Thread(target=backend.heartbeat_forever, daemon=True).start()
    print("Lab Mode is READY")
    print(f"Candidate URL: {share_url}")
    print(f"Candidate username: {backend.username}")
    print(f"Candidate password: {backend.password}")
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        demo.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="QuickInterviewTest fixed Colab runner")
    parser.add_argument("--base-url", default=os.environ.get("QIT_BASE_URL"), required="QIT_BASE_URL" not in os.environ)
    parser.add_argument("--runner-token", default=os.environ.get("QIT_RUNNER_TOKEN"), required="QIT_RUNNER_TOKEN" not in os.environ)
    arguments = parser.parse_args()
    run(arguments.base_url, arguments.runner_token)
