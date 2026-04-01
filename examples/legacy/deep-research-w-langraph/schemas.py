"""
Data schemas for the research pipeline using Pydantic models.
"""

from typing import List
from pydantic import BaseModel, Field


class SearchQueries(BaseModel):
    """Search queries to execute"""
    thoughts: str = Field(description="Reasoning about the search strategy")
    queries: List[str] = Field(description="List of search queries to execute")


class ResearchAnalysis(BaseModel):
    """Research analysis output"""
    thoughts: str = Field(description="Analysis of the research question")
    key_concepts: List[str] = Field(description="Main concepts to research")
    approach: str = Field(description="Research approach")


class ResearchSynthesis(BaseModel):
    """Research synthesis output"""
    thoughts: str = Field(description="Synthesis reasoning")
    main_findings: List[str] = Field(description="Key findings with source references")
    gaps: List[str] = Field(description="Knowledge gaps that need additional research")
    source_summary: List[str] = Field(description="Summary of what each source contributed")


class ExtractedFacts(BaseModel):
    """Facts extracted from web content"""
    thoughts: str = Field(description="Reasoning about fact extraction")
    key_facts: List[str] = Field(description="Key facts relevant to the research question")
    supporting_data: List[str] = Field(description="Supporting statistics, numbers, or evidence")
    relevant_quotes: List[str] = Field(description="Important direct quotes from the source")


class SourceCitation(BaseModel):
    """Individual source citation"""
    number: int = Field(description="Citation number")
    title: str = Field(description="Source title")
    url: str = Field(description="Source URL")
    accessed_date: str = Field(description="Date accessed")


class FinalReport(BaseModel):
    """Final research report with proper citations"""
    thoughts: str = Field(description="Report structure reasoning")
    summary: str = Field(description="Executive summary with inline citations [1], [2], etc.")
    findings: str = Field(description="Detailed findings with inline citations [1], [2], etc.")
    conclusions: str = Field(description="Conclusions with inline citations [1], [2], etc.")
    citations: List[SourceCitation] = Field(description="Numbered list of all sources cited")
