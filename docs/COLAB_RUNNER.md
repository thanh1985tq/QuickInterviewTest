# Colab + Gradio Lab Mode

Lab Mode is experimental and must be selected per attempt. It uses the same immutable snapshot, answers, deadline, submission, scoring, and review records as Standard Web.

## Launch

1. Create a `COLAB_GRADIO` test instance and copy the single-use runner token from the response.
2. Download the fixed notebook from `/lab/QuickInterviewTest.ipynb` and open it in Colab.
3. Set `BACKEND_URL` to the HTTPS application URL and paste the runner token.
4. Run all cells. The notebook downloads the matching fixed runner and pinned dependencies from the application.
5. Wait for `Lab Mode is READY`. Copy the displayed Gradio URL, username, and separate password to the candidate through an appropriate channel.
6. Confirm the admin deployment endpoint reports `READY` before sending the link.

The exchange token works once. It is different from the candidate token and is stored only as a hash. The exchanged backend credential is scoped to one deployment and expires. Gradio itself requires candidate-specific authentication.

## Recovery

If Colab stops, saved answers remain in Node.js storage. Create a new runner token with `POST /api/test-instances/{instanceId}/runner-token`, rerun the fixed notebook, and distribute the new URL and credentials only after the new generation is `READY`. Relaunch closes the previous deployment and its backend credential.

Missing heartbeats cause the admin status endpoint to mark a deployment `OFFLINE`. A runner heartbeat can restore the current generation if its credential has not expired or been closed.

## Security boundary

The runner manifest contains no answer key or scoring rubric. `CODE_ANSWER` and all other responses are plain text sent to Node.js; the notebook never evaluates or runs candidate input. One runner serves one attempt. Gradio is temporary rendering infrastructure, not persistent storage or a source of business rules.
