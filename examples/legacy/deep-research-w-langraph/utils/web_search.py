"""
Web search and content extraction utilities.
"""

import time
from typing import Dict, List, Any
import requests
from bs4 import BeautifulSoup
from ddgs import DDGS

from opperai import Opper
from schemas import ExtractedFacts

# Initialize Opper client (will be set by main module)
opper = None


def set_opper_client(client: Opper):
    """Set the Opper client for this module"""
    global opper
    opper = client


def fetch_web_content(url: str, timeout: int = 10) -> str:
    """Fetch and extract text content from a web page"""
    try:
        # Validate URL
        if not url or not url.strip():
            return ""
        
        # Ensure URL has a scheme
        if not url.startswith(('http://', 'https://')):
            url = 'https://' + url
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        
        response = requests.get(url, headers=headers, timeout=timeout)
        response.raise_for_status()
        
        # Parse HTML content
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Remove script and style elements
        for script in soup(["script", "style", "nav", "header", "footer", "aside"]):
            script.decompose()
        
        # Get text content
        text = soup.get_text()
        
        # Clean up whitespace
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        text = ' '.join(chunk for chunk in chunks if chunk)
        
        # Limit content length for processing efficiency
        max_content_length = 10000
        if len(text) > max_content_length:
            text = text[:max_content_length] + "... [content truncated]"
        
        return text
        
    except requests.exceptions.RequestException as e:
        print(f"  ⚠️ Failed to fetch {url}: {e}")
        return ""
    except Exception as e:
        print(f"  ⚠️ Error processing {url}: {e}")
        return ""


def extract_facts_from_content(content: str, title: str, query: str, research_question: str) -> Dict[str, Any]:
    """Extract relevant facts from web content using AI"""
    try:
        result = opper.call(
            name="extract_facts_from_content",
            instructions="""Extract key facts, data, and quotes from this web content that are relevant to the research question and search query. 
            Focus on specific facts, statistics, findings, and important quotes. Ignore generic information, navigation text, or irrelevant content.
            Be selective and only extract information that directly relates to the research topic.""",
            output_schema=ExtractedFacts,
            input={
                "research_question": research_question,
                "search_query": query,
                "source_title": title,
                "content": content[:4000]  # Limit content for processing
            },
            model="gcp/gemini-2.0-flash"
        )
        
        return {
            "facts_extracted": True,
            "key_facts": result.json_payload.get("key_facts", []),
            "supporting_data": result.json_payload.get("supporting_data", []),
            "relevant_quotes": result.json_payload.get("relevant_quotes", []),
            "extraction_thoughts": result.json_payload.get("thoughts", "")
        }
        
    except Exception as e:
        print(f"    ⚠️ Fact extraction failed: {e}")
        return {
            "facts_extracted": False,
            "key_facts": [],
            "supporting_data": [],
            "relevant_quotes": [],
            "extraction_thoughts": f"Extraction failed: {e}"
        }


def search_web(query: str, max_results: int = 3, research_question: str = "") -> List[Dict[str, Any]]:
    """Search DuckDuckGo, fetch content, and extract relevant facts"""
    try:
        with DDGS() as ddgs:
            search_results = list(ddgs.text(query, max_results=max_results))
            
            enriched_results = []
            for result in search_results:
                # DuckDuckGo uses 'href' for URL, not 'link'
                url = result.get("href", "")
                title = result.get("title", "")
                snippet = result.get("body", "")
                
                # Skip results with empty or invalid URLs
                if not url or not url.strip():
                    print(f"    ⚠️ Skipping {title}: No valid URL")
                    continue
                
                print(f"    📄 Fetching: {title}")
                
                # Fetch full page content
                full_content = fetch_web_content(url)
                
                if full_content.strip():
                    print(f"    🧠 Extracting facts...")
                    # Extract facts from the full content
                    fact_extraction = extract_facts_from_content(
                        full_content, title, query, research_question
                    )
                    
                    enriched_results.append({
                        "title": title,
                        "url": url,
                        "snippet": snippet,
                        "content": full_content[:1000],  # Store limited content for reference
                        "key_facts": fact_extraction["key_facts"],
                        "supporting_data": fact_extraction["supporting_data"],
                        "relevant_quotes": fact_extraction["relevant_quotes"],
                        "extraction_thoughts": fact_extraction["extraction_thoughts"],
                        "facts_extracted": fact_extraction["facts_extracted"],
                        "content_length": len(full_content),
                        "fetched_successfully": True
                    })
                else:
                    # Fallback to snippet only
                    enriched_results.append({
                        "title": title,
                        "url": url,
                        "snippet": snippet,
                        "content": snippet,
                        "key_facts": [],
                        "supporting_data": [],
                        "relevant_quotes": [],
                        "extraction_thoughts": "Used snippet only - full content not available",
                        "facts_extracted": False,
                        "content_length": len(snippet),
                        "fetched_successfully": False
                    })
            
            return enriched_results
            
    except Exception as e:
        print(f"Search failed for '{query}': {e}")
        return []


def prepare_sources_for_citation(search_results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Prepare sources with citation information for AI processing"""
    cited_sources = []
    seen_urls = set()
    citation_number = 1
    
    for result in search_results:
        url = result.get("url", "")
        # Skip duplicates
        if url and url not in seen_urls:
            cited_sources.append({
                "citation_number": citation_number,
                "title": result.get("title", ""),
                "url": url,
                "content": result.get("content", ""),
                "query": result.get("query", ""),
                "accessed_date": result.get("timestamp", time.strftime("%Y-%m-%d"))
            })
            seen_urls.add(url)
            citation_number += 1
    
    return cited_sources
