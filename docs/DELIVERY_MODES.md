# Delivery-mode capability matrix

| Capability | Standard Web | Colab + Gradio Lab |
| --- | --- | --- |
| Status in Version 1 | Default, production path | Experimental, selected attempts only |
| Business logic and source of truth | Node.js | Node.js |
| Persistent storage | Configured SQLite/PostgreSQL | Configured SQLite/PostgreSQL through Node.js |
| Candidate authentication | Scoped expiring candidate token | Gradio credentials plus runner-scoped backend access |
| Question/answer rendering | Express-served web UI | Fixed versioned Python/Gradio runner |
| Answer autosave and resume | Yes | Yes, through Node.js APIs |
| Server-authoritative deadline | Yes | Yes |
| Objective scoring | Node.js on submit | Node.js on submit |
| Manual review | Admin web UI | Admin web UI |
| Correct answers in client manifest | Never | Never |
| Candidate code execution | No; text only | No; text only |
| Availability | While web service/database are available | Also depends on a live Colab runtime |
| Recovery | Refresh/reconnect | Relaunch runner; saved answers remain |
| Link may be sent | When attempt is invited/available | Only when deployment is `READY` |

Templates and question snapshots are delivery-neutral. The delivery mode is selected for each test instance so one published template can serve both channels without duplicating questions, scoring, or result data.

