from dataclasses import dataclass
from typing import Any, Dict, Optional

@dataclass
class Subject:
    type: str
    id: str

@dataclass
class Entitlements:
    active: bool
    reason: str
    required: Optional[Dict[str, Any]] = None
    expires_at: Optional[str] = None
