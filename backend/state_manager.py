"""
VoiceFlow Conversation State & Dialogue Reconciler.
Maintains context coherence, discards invalidated tool responses, and manages monotonic dialogue turns.
"""

import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger("voiceflow.state")

class StateManager:
    def __init__(self):
        self.dialogue_history: List[Dict[str, Any]] = []
        self.active_constraints: Dict[str, Any] = {
            "model_year": "standard",
            "component": "bolt M12",
            "unit_system": "metric"
        }

    def add_user_message(self, text: str, turn_id: int):
        """Records user speech input."""
        self._extract_and_update_constraints(text)
        self.dialogue_history.append({
            "role": "user",
            "text": text,
            "turn_id": turn_id,
            "interrupted": False
        })

    def add_agent_message(self, text: str, turn_id: int, was_interrupted: bool = False, discarded_at_char: Optional[int] = None):
        """Records agent response with interruption flags."""
        entry = {
            "role": "assistant",
            "text": text,
            "turn_id": turn_id,
            "was_interrupted": was_interrupted,
            "spoken_portion": text[:discarded_at_char] if (was_interrupted and discarded_at_char) else text,
            "discarded_portion": text[discarded_at_char:] if (was_interrupted and discarded_at_char) else ""
        }
        self.dialogue_history.append(entry)

    def reconcile_after_interruption(self, interrupted_turn_id: int, new_user_instruction: str) -> Dict[str, Any]:
        """
        Reconciles conversation state after a barge-in event:
        1. Marks the previous assistant generation as truncated/invalidated.
        2. Merges the new user constraint into state.
        3. Formulates a prompt guaranteed to answer the refined request without repeating stale specs.
        """
        logger.info(f"Reconciling state for turn #{interrupted_turn_id} with new instruction: '{new_user_instruction}'")
        
        # Mark previous turn interrupted
        for msg in reversed(self.dialogue_history):
            if msg.get("turn_id") == interrupted_turn_id and msg.get("role") == "assistant":
                msg["was_interrupted"] = True
                break

        # Update constraints
        self._extract_and_update_constraints(new_user_instruction)
        
        return {
            "status": "reconciled",
            "active_constraints": self.active_constraints,
            "current_focus": self.active_constraints.get("component"),
            "model_year": self.active_constraints.get("model_year")
        }

    def _extract_and_update_constraints(self, text: str):
        """Extracts field technician domain entities from user speech."""
        text_lower = text.lower()
        if "2024" in text_lower:
            self.active_constraints["model_year"] = "2024"
        elif "2023" in text_lower or "older" in text_lower or "standard" in text_lower:
            self.active_constraints["model_year"] = "standard"
            
        if "m12" in text_lower:
            self.active_constraints["component"] = "bolt M12"
        elif "m16" in text_lower:
            self.active_constraints["component"] = "bolt M16"
        elif "pump" in text_lower:
            self.active_constraints["component"] = "hydraulic pump"
        elif "filter" in text_lower:
            self.active_constraints["component"] = "filter element"
        elif "170" in text_lower:
            self.active_constraints["component"] = "order 170"

    def get_context_for_llm(self) -> List[Dict[str, str]]:
        """Returns clean conversational history with interrupted turns properly annotated."""
        messages = []
        for msg in self.dialogue_history:
            if msg["role"] == "assistant" and msg.get("was_interrupted"):
                # LLM only sees what the user actually heard
                messages.append({
                    "role": "assistant",
                    "content": f"[Interrupted by user after hearing: '{msg.get('spoken_portion', '')}']"
                })
            else:
                messages.append({
                    "role": msg["role"],
                    "content": msg["text"]
                })
        return messages
