"""
Planning node - Analyzes research questions and generates search queries.
"""

from typing import Dict, Any
from opperai import Opper

from schemas import ResearchAnalysis, SearchQueries

# Opper client will be set by main module
opper = None


def set_opper_client(client: Opper):
    """Set the Opper client for this module"""
    global opper
    opper = client


def analyze_question(state: Dict[str, Any]) -> Dict[str, Any]:
    """
    Plan the research approach and generate initial search queries.
    
    This node combines research analysis and query generation into a single step:
    1. Analyzes the research question to identify key concepts
    2. Generates targeted search queries based on the analysis
    
    Args:
        state: Pipeline state containing the research question
        
    Returns:
        Updated state with analysis and search queries
    """
    try:
        parent_span_id = state.get("span_id")
        
        # First analyze the question
        analysis_call_params = {
            "name": "analyze_research_question",
            "instructions": "Analyze this research question and identify key concepts and research approach.",
            "output_schema": ResearchAnalysis,
            "input": {"question": state["question"]},
            "model": "fireworks/glm-4.5-air"
        }
        if parent_span_id:
            analysis_call_params["parent_span_id"] = parent_span_id
        
        analysis_result = opper.call(**analysis_call_params)
        
        # Then generate search queries based on analysis
        queries_call_params = {
            "name": "generate_search_queries",
            "instructions": "Generate specific search queries based on the research analysis.",
            "output_schema": SearchQueries,
            "input": {
                "question": state["question"],
                "analysis": analysis_result.json_payload
            },
            "model": "xai/grok-4"
        }
        if parent_span_id:
            queries_call_params["parent_span_id"] = parent_span_id
        
        queries_result = opper.call(**queries_call_params)
        
        queries = queries_result.json_payload["queries"]
        print(f"🎯 Generated {len(queries)} search queries")
        
        return {
            **state,
            "analysis": analysis_result.json_payload,
            "search_queries": queries_result.json_payload,
            "step": "plan_complete"
        }
    except Exception as e:
        return {
            **state,
            "errors": state.get("errors", []) + [f"Planning failed: {e}"],
            "step": "failed"
        }
