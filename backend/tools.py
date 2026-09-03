"""
VoiceFlow Field Service Tools & Delayed Lookup Engine.
Designed for stress-testing full-duplex voice interruption during slow async operations.
"""

import asyncio
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger("voiceflow.tools")

# Mock Field Equipment Knowledge Base
EQUIPMENT_DATABASE = {
    "bolt m12": {
        "title": "Bolt M12 Standard",
        "torque_spec": "85 Nm",
        "thread_pitch": "1.75 mm",
        "grade": "Grade 8.8 High-Tensile Steel",
        "notes": "Lubricate threads lightly before torquing."
    },
    "bolt m12 2024": {
        "title": "Bolt M12 (2024 Revision)",
        "torque_spec": "92 Nm",
        "thread_pitch": "1.75 mm",
        "grade": "Grade 10.9 with titanium washer",
        "notes": "Requires cross-pattern tightening for 2024 chassis."
    },
    "bolt m16": {
        "title": "Bolt M16 Heavy Duty",
        "torque_spec": "170 Nm",
        "thread_pitch": "2.0 mm",
        "grade": "Grade 10.9 High-Tensile Steel",
        "notes": "Verify calibrated torque wrench certification."
    },
    "hydraulic pump": {
        "title": "Hydraulic Pump HP-400",
        "operating_pressure": "350 bar",
        "max_flow_rate": "120 L/min",
        "operating_temp": "65°C max",
        "fluid_type": "ISO VG 46 Anti-Wear"
    },
    "filter element": {
        "title": "High-Pressure Filter F-90",
        "micron_rating": "5 micron",
        "replacement_interval": "500 operating hours",
        "bypass_pressure": "3.5 bar"
    },
    "order 170": {
        "order_id": "170",
        "customer": "Rahul Sharma",
        "status": "Out for delivery",
        "estimated_arrival": "Today by 4:00 PM",
        "carrier": "Express Logistics India"
    }
}


async def query_equipment_database(
    query: str,
    delay_seconds: float = 3.0,
    cancellation_event: Optional[asyncio.Event] = None
) -> Dict[str, Any]:
    """
    Executes a simulated heavy field database query with an artificial delay.
    Monitors cancellation_event every 50ms so mid-tool interruptions abort immediately.
    """
    query_norm = query.lower().strip()
    logger.info(f"Starting async tool query: '{query_norm}' with artificial delay {delay_seconds}s")
    
    elapsed = 0.0
    step = 0.05  # 50ms polling resolution
    
    while elapsed < delay_seconds:
        if cancellation_event and cancellation_event.is_set():
            logger.warning(f"Tool execution ABORTED for '{query_norm}' due to user barge-in after {elapsed:.2f}s!")
            return {
                "cancelled": True,
                "stale": True,
                "query": query,
                "elapsed_seconds": elapsed,
                "message": "Tool query discarded due to user interruption."
            }
        await asyncio.sleep(step)
        elapsed += step

    # Match best record
    matched_data = None
    for key, data in EQUIPMENT_DATABASE.items():
        if key in query_norm:
            matched_data = data
            break
            
    if not matched_data:
        # Fallback dynamic answer
        matched_data = {
            "title": f"Query result for {query}",
            "torque_spec": "75 Nm standard spec",
            "notes": "Generic specification. Please verify serial number."
        }

    logger.info(f"Tool execution COMPLETED for '{query_norm}' in {elapsed:.2f}s")
    return {
        "cancelled": False,
        "stale": False,
        "query": query,
        "data": matched_data
    }
