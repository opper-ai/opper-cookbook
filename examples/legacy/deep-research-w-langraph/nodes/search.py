"""
Search nodes - Execute web searches and extract facts from content.
"""

import time
from typing import Dict, Any
from opperai import Opper

from schemas import SearchQueries
from utils import search_web

# Opper client will be set by main module
opper = None


def set_opper_client(client: Opper):
    """Set the Opper client for this module"""
    global opper
    opper = client


def execute_search(state: Dict[str, Any]) -> Dict[str, Any]:
    """
    Execute initial web searches based on generated queries.
    
    This node:
    1. Takes the search queries from the planning phase
    2. Executes web searches for each query
    3. Fetches full page content for each result
    4. Extracts relevant facts using AI
    5. Tracks search and extraction statistics
    
    Args:
        state: Pipeline state containing search queries
        
    Returns:
        Updated state with search results and extracted facts
    """
    try:
        parent_span_id = state.get("span_id")
        all_results = []
        queries = state["search_queries"]["queries"]
        
        # Create a span for the search phase
        search_span = None
        if parent_span_id:
            try:
                search_span = opper.spans.create(
                    name="web_search_phase",
                    input={"queries": queries}
                )
                # Note: parent_span_id might need to be set differently depending on Opper SDK version
            except Exception as e:
                print(f"⚠️ Failed to create search span: {e}")
        
        for query in queries:
            print(f"🔍 Searching: {query}")
            results = search_web(query, max_results=3, research_question=state["question"])
            
            for result in results:
                all_results.append({
                    "query": query,
                    "title": result["title"],
                    "url": result["url"],
                    "snippet": result["snippet"],
                    "content": result["content"],
                    "key_facts": result["key_facts"],
                    "supporting_data": result["supporting_data"],
                    "relevant_quotes": result["relevant_quotes"],
                    "extraction_thoughts": result["extraction_thoughts"],
                    "facts_extracted": result["facts_extracted"],
                    "content_length": result["content_length"],
                    "fetched_successfully": result["fetched_successfully"],
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
                })
                
                # Show extraction status
                if result["facts_extracted"]:
                    facts_count = len(result["key_facts"]) + len(result["supporting_data"]) + len(result["relevant_quotes"])
                    print(f"  ✅ {result['title']}: {facts_count} facts extracted")
                elif result["fetched_successfully"]:
                    print(f"  ⚠️ {result['title']}: content fetched but fact extraction failed")
                else:
                    print(f"  ⚠️ {result['title']}: snippet only")
        
        # Update search span with results including fetch and extraction statistics
        if search_span:
            try:
                successful_fetches = len([r for r in all_results if r.get("fetched_successfully", False)])
                successful_extractions = len([r for r in all_results if r.get("facts_extracted", False)])
                total_content_chars = sum(r.get("content_length", 0) for r in all_results)
                total_facts = sum(len(r.get("key_facts", [])) + len(r.get("supporting_data", [])) + len(r.get("relevant_quotes", [])) for r in all_results)
                
                opper.spans.update(
                    span_id=search_span.id,
                    output={
                        "total_results": len(all_results),
                        "queries_executed": len(queries),
                        "successful_fetches": successful_fetches,
                        "successful_extractions": successful_extractions,
                        "total_facts_extracted": total_facts,
                        "total_content_chars": total_content_chars,
                        "average_content_length": total_content_chars // len(all_results) if all_results else 0,
                        "average_facts_per_source": total_facts // len(all_results) if all_results else 0
                    }
                )
            except Exception as e:
                print(f"⚠️ Failed to update search span: {e}")
        
        return {
            **state,
            "search_results": all_results,
            "step": "search_complete"
        }
    except Exception as e:
        return {
            **state,
            "errors": state.get("errors", []) + [f"Search failed: {e}"],
            "step": "failed"
        }


def execute_additional_search(state: Dict[str, Any]) -> Dict[str, Any]:
    """
    Execute additional searches to fill knowledge gaps.
    
    This node:
    1. Analyzes gaps identified in the synthesis
    2. Generates targeted queries to fill those gaps
    3. Executes additional web searches
    4. Maintains citation numbering continuity
    
    Args:
        state: Pipeline state containing synthesis with identified gaps
        
    Returns:
        Updated state with additional search results
    """
    try:
        # Generate queries to fill gaps identified in synthesis
        synthesis = state.get("synthesis", {})
        gaps = synthesis.get("gaps", [])
        
        if not gaps:
            print("🔍 No gaps identified, skipping additional search")
            return {
                **state,
                "step": "additional_search_complete"
            }
        
        # Generate targeted queries for the gaps
        parent_span_id = state.get("span_id")
        
        call_params = {
            "name": "generate_gap_filling_queries",
            "instructions": "Generate specific search queries to fill the knowledge gaps identified in the synthesis.",
            "output_schema": SearchQueries,
            "input": {
                "question": state["question"],
                "synthesis": synthesis,
                "gaps": gaps,
                "previous_queries": state["search_queries"]["queries"]
            },
            "model": "fireworks/glm-4.5-air"
        }
        if parent_span_id:
            call_params["parent_span_id"] = parent_span_id
        
        result = opper.call(**call_params)
        
        additional_results = []
        gap_queries = result.json_payload["queries"]
        
        for query in gap_queries:
            print(f"🔍 Gap-filling search: {query}")
            results = search_web(query, max_results=2, research_question=state["question"])
            
            for result in results:
                additional_results.append({
                    "query": query,
                    "title": result["title"],
                    "url": result["url"],
                    "snippet": result["snippet"],
                    "content": result["content"],
                    "key_facts": result["key_facts"],
                    "supporting_data": result["supporting_data"],
                    "relevant_quotes": result["relevant_quotes"],
                    "extraction_thoughts": result["extraction_thoughts"],
                    "facts_extracted": result["facts_extracted"],
                    "content_length": result["content_length"],
                    "fetched_successfully": result["fetched_successfully"],
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "search_type": "gap_filling"
                })
                
                # Show extraction status
                if result["facts_extracted"]:
                    facts_count = len(result["key_facts"]) + len(result["supporting_data"]) + len(result["relevant_quotes"])
                    print(f"  ✅ {result['title']}: {facts_count} facts extracted")
                elif result["fetched_successfully"]:
                    print(f"  ⚠️ {result['title']}: content fetched but fact extraction failed")
                else:
                    print(f"  ⚠️ {result['title']}: snippet only")
        
        # Combine with existing results
        all_results = state["search_results"] + additional_results
        
        # Update cited sources to include new sources with continuing citation numbers
        existing_cited_sources = state.get("cited_sources", [])
        next_citation_number = len(existing_cited_sources) + 1
        
        new_cited_sources = []
        seen_urls = set([s["url"] for s in existing_cited_sources])
        
        for result in additional_results:
            url = result.get("url", "")
            if url and url not in seen_urls:
                new_cited_sources.append({
                    "citation_number": next_citation_number,
                    "title": result.get("title", ""),
                    "url": url,
                    "content": result.get("content", ""),
                    "query": result.get("query", ""),
                    "accessed_date": result.get("timestamp", time.strftime("%Y-%m-%d"))
                })
                seen_urls.add(url)
                next_citation_number += 1
        
        updated_cited_sources = existing_cited_sources + new_cited_sources
        
        return {
            **state,
            "search_results": all_results,
            "additional_queries": result.json_payload,
            "cited_sources": updated_cited_sources,
            "step": "additional_search_complete"
        }
    except Exception as e:
        return {
            **state,
            "errors": state.get("errors", []) + [f"Additional search failed: {e}"],
            "step": "failed"
        }
