-- Drop existing function if any
DROP FUNCTION IF EXISTS notify_note_change();

-- Create the trigger function
CREATE OR REPLACE FUNCTION notify_note_change()
RETURNS trigger AS $$
DECLARE
    payload JSON;
BEGIN
    IF TG_OP = 'DELETE' THEN
        payload = json_build_object(
            'operation', TG_OP,
            'id', OLD.id,
            'title', OLD.title,
            'content', OLD.content
        );
    ELSE
        payload = json_build_object(
            'operation', TG_OP,
            'id', NEW.id,
            'title', NEW.title,
            'content', NEW.content
        );
    END IF;

    PERFORM pg_notify('note_changes', payload::text);

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER note_change_trigger
AFTER INSERT OR UPDATE OR DELETE ON note
FOR EACH ROW
EXECUTE FUNCTION notify_note_change();
