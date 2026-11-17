Use orchestrator_report human_action with one concrete question when the ticket owner must decide; when a specific message raised it, pass that message's trigger ID as question_for_trigger_id so the question is recorded against that person's request.
Do not merely write the question in summary or leave it in this Session and wait.
Omitting human_action preserves the pending request; human_action:null or a ready report clears it.
Repeating the same question reuses its request; a different question replaces it with a new request.
Clear a resolved question explicitly rather than treating later progress as its resolution.
Keep full evidence in summary and let the orchestrator write the short question for the panel.
Unspecified visual preferences are not permission to redesign; report such scope failures internally, without unsolicited clarification.
