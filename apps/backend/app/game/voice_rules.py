"""Voice room membership rules.

Private voice room ids are derived from the two player ids taking part, and
every player id is public in the room snapshot. Any client could therefore name
someone else's call, so who may enter which voice room is decided here - never
by trusting the room name a client sends.
"""

from .room_state import Player, RoomState

PRIVATE_VOICE_SEPARATOR = ":private:"

# A voice room name is either one of the fixed public rooms or "<id>:private:<id>";
# nothing legitimate is longer, and the value is kept in memory and broadcast.
MAX_VOICE_ROOM_LENGTH = 120

# The room everybody gathers in when day breaks. Must stay in sync with the first
# entry of `voiceRooms` in apps/frontend/src/game-ui/gameConfig.ts, which the
# frontend voiceRooms test asserts.
DEFAULT_VOICE_ROOM = "Town Square"


def private_voice_room_for(player_id: str, target_player_id: str) -> str:
    """Return the canonical private voice room id for exactly these two players.

    Mirrors privateVoiceRoomFor() in the frontend.
    """
    return PRIVATE_VOICE_SEPARATOR.join(sorted([player_id, target_player_id]))


def can_join_voice_room(room: RoomState, sender: Player, voice_room: str) -> bool:
    """Return whether one player may join one voice room in the current phase."""
    if PRIVATE_VOICE_SEPARATOR in voice_room:
        parties = voice_room.split(PRIVATE_VOICE_SEPARATOR)
        # Without this check any player - including the storyteller - could join
        # a call between two other players and silently listen in.
        if len(parties) != 2 or sender.id not in parties:
            return False
        if sender.is_storyteller or room.phase != "night":
            return True
        # At night a private call must involve the storyteller (they called the
        # player); players cannot pair up privately behind the storyteller's back.
        storyteller = next((player for player in room.players if player.is_storyteller), None)
        return storyteller is not None and storyteller.id in parties
    if sender.is_storyteller or room.phase != "night":
        return True
    # Night: public rooms only stay reachable when night voice is explicitly allowed.
    return room.allow_public_voice_during_night
