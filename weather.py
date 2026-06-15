import asyncio
import httpx
from mcp.server import Server
from mcp.types import Tool, TextContent
from mcp.server.stdio import stdio_server

app = Server("weather-server")

@app.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="get_weather",
            description="특정 도시의 현재 날씨를 가져옵니다",
            inputSchema={
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "도시 이름 (예: Seoul, Tokyo, New York)"
                    }
                },
                "required": ["city"]
            }
        )
    ]

@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if name == "get_weather":
        city = arguments["city"]
        
        async with httpx.AsyncClient() as client:
            geocode_url = f"https://geocoding-api.open-meteo.com/v1/search?name={city}&count=1"
            geo_response = await client.get(geocode_url)
            geo_data = geo_response.json()
            
            if not geo_data.get("results"):
                return [TextContent(
                    type="text",
                    text=f"도시 '{city}'를 찾을 수 없습니다."
                )]
            
            latitude = geo_data["results"][0]["latitude"]
            longitude = geo_data["results"][0]["longitude"]
            
            weather_url = f"https://api.open-meteo.com/v1/forecast?latitude={latitude}&longitude={longitude}&current_weather=true"
            weather_response = await client.get(weather_url)
            weather_data = weather_response.json()
            
            current = weather_data["current_weather"]
            
            result = f"""
 {city}의 현재 날씨:
 온도: {current['temperature']}°C
 풍속: {current['windspeed']} km/h
 풍향: {current['winddirection']}°
 시간: {current['time']}
"""
            
            return [TextContent(
                type="text",
                text=result
            )]
    
    return [TextContent(
        type="text",
        text=f"알 수 없는 도구: {name}"
    )]

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await app.run(
            read_stream,
            write_stream,
            app.create_initialization_options()
        )

if __name__ == "__main__":
    asyncio.run(main())