"""
Utility modules for the research pipeline.
"""

from .web_search import search_web, prepare_sources_for_citation, set_opper_client

__all__ = [
    "search_web",
    "prepare_sources_for_citation", 
    "set_opper_client"
]
